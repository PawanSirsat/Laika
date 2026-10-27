/**
 * The proposed agent UI on `/design/states` (LAI-536), in a real browser.
 *
 * Every state proposal §6 names is drawn with its words; the chip is the
 * neutral chip in both themes; the Agent picker is the app's combobox and
 * works from the keyboard; the hand-off dialog holds focus and gives it back;
 * the inbox filters; nothing scrolls sideways at 390px.
 *
 * With `LAIKA_SHOTS` set, the page lands there light and dark at 1440 and
 * 390, and the dialog open — the PR's evidence.
 */

import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { closeBrowser, open, setTheme, until, type Harness } from './harness.ts';

const SHOTS = process.env.LAIKA_SHOTS;

/**
 * The agent section, whole. The app scrolls inside its shell rather than the
 * document, so a `fullPage` shot stops at the first screen: the viewport is
 * grown to the section's height for the picture and put back after.
 */
async function shoot(page: Page, name: string): Promise<void> {
  if (SHOTS === undefined) return;
  mkdirSync(SHOTS, { recursive: true });
  const size = page.viewportSize();
  if (size === null) throw new Error('no viewport');
  const section = page.locator('[data-agent-gallery]');
  const tall = await section.evaluate((el) => el.scrollHeight);
  await page.setViewportSize({ width: size.width, height: tall + 400 });
  await section.screenshot({ path: join(SHOTS, `${name}.png`) });
  await page.setViewportSize(size);
}

async function gallery(width = 1440): Promise<Harness> {
  const h = await open(
    '/design/states',
    {},
    {
      before: async (page) => {
        await page.setViewportSize({ width, height: 900 });
      },
    },
  );
  await h.page.locator('[data-agent-gallery]').waitFor({ timeout: 20_000 });
  return h;
}

const specimen = (page: Page, id: string) => page.locator(`[data-specimen="${id}"]`);

after(async () => {
  await closeBrowser();
});

void describe('agent states on /design/states (LAI-536)', () => {
  void test('every §6 state has an entry, in words', async () => {
    const h = await gallery();
    try {
      const ids = await h.page
        .locator('[data-agent-gallery] [data-specimen]')
        .evaluateAll((els) => els.map((el) => el.getAttribute('data-specimen')));
      assert.deepEqual(ids, [
        'chip',
        'chip-and-badge',
        'card-states',
        'picker',
        'panel-working',
        'panel-earlier-note',
        'panel-no-note',
        'panel-no-checkpoint',
        'panel-offered',
        'dialog',
        'inbox',
        'wizard',
        'credential-created',
        'connected',
        'ready',
      ]);

      // The chip, beside the person.
      const chip = specimen(h.page, 'chip').locator('[data-agent-chip]');
      assert.equal((await chip.innerText()).trim(), 'Claude Code · laptop-1');
      assert.equal(await specimen(h.page, 'chip').locator('.card-avatar').count(), 1);

      // Each execution state: its label in text and a shape, on its own card.
      const states = specimen(h.page, 'card-states').locator('[data-exec-state]');
      const labels = await states.locator('.exec-state-label').allInnerTexts();
      assert.deepEqual(labels, [
        'Waiting for agent',
        'Waiting for approval',
        'Working',
        'Connection lost',
        'Recovery available',
        'Save needs attention',
        'Verification pending',
      ]);
      const shapes = await states.evaluateAll((els) =>
        els.map((el) => el.querySelector('svg')?.getAttribute('data-shape')),
      );
      assert.equal(new Set(shapes).size, 7, 'two states share a shape');

      // The drawer's wording.
      const text = await h.page.locator('[data-agent-gallery]').innerText();
      for (const words of [
        'Intended agent',
        'Working session',
        'Last seen',
        'Latest verified save',
        'Note describes an earlier save',
        'No continuation note',
        'Automatic recovery unavailable — no saved checkpoint',
        'Offered to Codex · desktop-2 — waiting for it to accept',
        'Credential created',
        'Connected',
        'Ready for recovery',
        'Verify a request from this agent',
      ]) {
        assert.ok(text.includes(words), `"${words}" is not on the page`);
      }
      assert.ok(
        !/\baccepted\b/i.test(
          await specimen(h.page, 'panel-offered').locator('[data-exec-panel]').innerText(),
        ),
        'the sender is shown "accepted"',
      );

      // Details: the generation and the full SHA, folded away until asked.
      const details = specimen(h.page, 'panel-working').locator('details');
      assert.equal(await details.getAttribute('open'), null);
      await details.locator('summary').click();
      const shown = await details.innerText();
      assert.match(shown, /Claim generation\s+4/);
      assert.match(shown, /[0-9a-f]{40}/);
    } finally {
      await h.close();
    }
  });

  void test('the existing agent badge sits next to the chip, with its own meaning', async () => {
    const h = await gallery();
    try {
      const card = specimen(h.page, 'chip-and-badge');
      const badge = card.locator('[data-mcp-badge]');
      assert.equal(await badge.count(), 1);
      assert.equal(await badge.getAttribute('title'), "Written by Ada Okafor's agent");
      assert.equal(await card.locator('[data-agent-chip]').count(), 1);
      assert.equal(await specimen(h.page, 'chip').locator('[data-mcp-badge]').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('the chip is the neutral chip in both themes', async () => {
    const h = await gallery();
    try {
      for (const theme of ['dark', 'light']) {
        await setTheme(h.page, theme);
        const [chip, want] = await h.page.evaluate(() => {
          const el = document.querySelector('[data-agent-chip]');
          if (el === null) throw new Error('no chip');
          const s = getComputedStyle(el);
          const probe = document.createElement('span');
          probe.style.color = 'var(--text-secondary)';
          probe.style.backgroundColor = 'var(--chip-neutral-bg)';
          document.body.append(probe);
          const p = getComputedStyle(probe);
          const out = [
            [s.color, s.backgroundColor],
            [p.color, p.backgroundColor],
          ];
          probe.remove();
          return out;
        });
        assert.deepEqual(
          chip,
          want,
          `${theme}: the chip is not --text-secondary on --chip-neutral-bg`,
        );
      }
    } finally {
      await h.close();
    }
  });

  void test('the Agent picker works from the keyboard and says why an agent is out', async () => {
    const h = await gallery();
    try {
      const box = specimen(h.page, 'picker').getByRole('combobox', { name: 'Agent' });
      assert.equal(await box.getAttribute('data-value'), 'ag-laptop');
      await box.focus();
      await h.page.keyboard.press('ArrowDown');
      await until(async () => (await box.getAttribute('aria-expanded')) === 'true');
      const list = h.page.locator(`[id="${(await box.getAttribute('aria-controls')) ?? ''}"]`);
      const options = await list.locator('[role="option"]').evaluateAll((els) =>
        els.map((el) => ({
          text: (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim(),
          disabled: el.getAttribute('aria-disabled') === 'true',
        })),
      );
      assert.deepEqual(options, [
        { text: 'No agent Human only', disabled: false },
        { text: 'Claude Code — Ada Okafor · laptop-1 Available', disabled: false },
        { text: 'Codex — Ada Okafor · desktop-2 Offline', disabled: false },
        { text: 'Cursor — Sam Reyes · studio-mac Available', disabled: false },
        { text: 'Gemini CLI — Ada Okafor · ci-runner Not granted on this space', disabled: true },
        { text: 'OpenCode — Sam Reyes · old-laptop Revoked', disabled: true },
      ]);
      // Down from Claude Code lands on Codex; Enter takes it.
      await h.page.keyboard.press('ArrowDown');
      await h.page.keyboard.press('Enter');
      await until(async () => (await box.getAttribute('data-value')) === 'ag-desktop');
      assert.equal(await box.getAttribute('aria-expanded'), 'false');
      assert.match(
        await specimen(h.page, 'picker').innerText(),
        /Offline\. The work request waits until this agent reconnects\./,
      );
      // Down past the last pickable agent skips the two that are out.
      await h.page.keyboard.press('ArrowDown');
      await until(async () => (await box.getAttribute('aria-expanded')) === 'true');
      for (let i = 0; i < 5; i += 1) await h.page.keyboard.press('ArrowDown');
      await h.page.keyboard.press('Enter');
      await until(async () => (await box.getAttribute('aria-expanded')) === 'false');
      assert.equal(await box.getAttribute('data-value'), 'ag-studio');
    } finally {
      await h.close();
    }
  });

  void test('the hand-off dialog holds focus, says the receiver must accept, and gives focus back', async () => {
    const h = await gallery();
    try {
      const opener = h.page.locator('[data-open-handoff="cross"]');
      await opener.click();
      const dialog = h.page.getByRole('dialog', { name: 'Offer LAI-142 to another agent' });
      await dialog.waitFor({ timeout: 5_000 });
      assert.equal(await dialog.getAttribute('aria-modal'), 'true');
      const words = await dialog.innerText();
      assert.match(words, /From\s+Claude Code · laptop-1/);
      assert.match(words, /To\s+Cursor · studio-mac\s+Sam Reyes/);
      assert.match(words, /Reason\s+Out of context window/);
      assert.match(words, /saved 12 min ago/);
      assert.match(words, /Approval required from Ada Okafor/);
      assert.match(words, /The receiver must accept\./);

      const inside = () => dialog.evaluate((el) => el.contains(document.activeElement));
      await until(inside);
      // Tab from the last control wraps to the first, and Shift+Tab back.
      for (let i = 0; i < 6; i += 1) {
        await h.page.keyboard.press('Tab');
        assert.equal(await inside(), true, `Tab ${String(i + 1)} left the dialog`);
      }
      await h.page.keyboard.press('Shift+Tab');
      assert.equal(await inside(), true, 'Shift+Tab left the dialog');

      await h.page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached', timeout: 5_000 });
      await until(() => opener.evaluate((el) => el === document.activeElement));
      assert.equal(await opener.evaluate((el) => el === document.activeElement), true);

      // Offering says offered — never accepted.
      await h.page.locator('[data-open-handoff="same"]').click();
      const same = h.page.getByRole('dialog');
      assert.match(await same.innerText(), /Not needed — the same person owns both agents/);
      await same.getByRole('button', { name: 'Offer', exact: true }).click();
      await same.waitFor({ state: 'detached', timeout: 5_000 });
      assert.equal(
        await specimen(h.page, 'dialog').getByRole('status').innerText(),
        'Offered — waiting for Codex · desktop-2 to accept.',
      );
    } finally {
      await h.close();
    }
  });

  void test('the inbox filters, and tells a work request from a recovery offer', async () => {
    const h = await gallery();
    try {
      const inbox = specimen(h.page, 'inbox');
      const kinds = () => inbox.locator('.handoff-row .handoff-kind').allInnerTexts();
      assert.deepEqual(await kinds(), ['Work request', 'Recovery offer', 'Hand-off']);
      const filters = await inbox
        .locator('[data-filter]')
        .evaluateAll((els) => els.map((el) => (el as HTMLElement).innerText.replace(/\s+/g, ' ')));
      assert.deepEqual(filters, [
        'Received 3 need your action',
        'Sent',
        'Needs approval 1 need your action',
        'Recovery 1 need your action',
      ]);
      await inbox.locator('[data-filter="recovery"]').click();
      assert.equal(
        await inbox.locator('[data-filter="recovery"]').getAttribute('aria-pressed'),
        'true',
      );
      assert.deepEqual(await kinds(), ['Recovery offer']);
      await inbox.locator('[data-filter="sent"]').click();
      assert.deepEqual(await kinds(), ['Hand-off', 'Work request']);
      assert.match(await inbox.innerText(), /Expired/);
    } finally {
      await h.close();
    }
  });

  for (const width of [1440, 390]) {
    void test(`both themes at ${String(width)}px, nothing scrolls sideways`, async () => {
      const h = await gallery(width);
      try {
        for (const theme of ['light', 'dark']) {
          await setTheme(h.page, theme);
          const over = await h.page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          assert.ok(
            over <= 0,
            `${theme} at ${String(width)}px scrolls sideways by ${String(over)}px`,
          );
          await shoot(h.page, `agent-states-${theme}-${String(width)}`);
          if (SHOTS !== undefined) {
            await h.page.locator('[data-open-handoff="cross"]').click();
            await h.page.getByRole('dialog').waitFor({ timeout: 5_000 });
            await h.page.screenshot({
              path: join(SHOTS, `agent-states-dialog-${theme}-${String(width)}.png`),
            });
            await h.page.keyboard.press('Escape');
            await h.page.getByRole('dialog').waitFor({ state: 'detached', timeout: 5_000 });
          }
        }
      } finally {
        await h.close();
      }
    });
  }
});
