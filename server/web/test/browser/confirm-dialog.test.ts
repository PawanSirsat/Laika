/**
 * The app's one confirmation (LAI-522), in a real browser: My day's
 * *Discard timer* asks and names the time it ran, Cancel loses nothing and
 * the action discards; the dialog is above everything, keeps the focus, and
 * Escape cancels; in both themes the action is the danger red; on a phone its
 * two buttons are full width, the action on top.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, setTheme, until, type ApiStub, type StubCall } from './harness.ts';
import { answerConfirm, confirmSettled } from './confirm.ts';
import { NOW, open } from './my-day-clock.ts';
import { TODAY, viewOf, weekData, weekStub } from './my-day-week.ts';

/** A timer running 42 minutes on LAI-11 as of the pinned clock. */
const TIMER = {
  started_at: NOW - 42 * 60_000,
  resumed_at: NOW - 42 * 60_000,
  paused_at: null,
  accumulated_ms: 0,
  tz: 'UTC',
  task: { id: 't11', key: 'LAI-11', title: 'Search matches keys' },
  kind: null,
  title: null,
};

function stub(calls: StubCall[]): ApiStub {
  const data = weekData();
  let timer: typeof TIMER | null = TIMER;
  const routes: Record<string, unknown> = { ...weekStub(data) };
  routes[`/api/v1/me/time?day=${TODAY}`] = () => ({
    ...(viewOf(TODAY, data) as Record<string, unknown>),
    timer,
  });
  routes['/api/v1/me/time/timer'] = (call: StubCall) => {
    calls.push(call);
    if (call.method === 'DELETE') timer = null;
    return null;
  };
  return routes;
}

after(async () => {
  await closeBrowser();
});

void describe('the confirmation (LAI-522)', () => {
  void test('Discard timer asks, names the time it ran; Cancel and Escape lose nothing; Discard discards', async () => {
    const calls: StubCall[] = [];
    const h = await open(`/my-day?day=${TODAY}`, stub(calls));
    try {
      await h.page.locator('[data-myday-ready]').waitFor({ timeout: 20_000 });
      const discard = h.page.getByRole('button', { name: 'Discard timer' }).first();
      await discard.click();
      const dialog = h.page.locator('[data-confirm-dialog]');
      await dialog.waitFor({ timeout: 5_000 });
      assert.equal(await dialog.getAttribute('role'), 'alertdialog');
      assert.match(await dialog.innerText(), /Discard the timer\?/);
      assert.match(await dialog.innerText(), /LAI-11\s+42 min run, not saved/);
      // Focus starts on Cancel, the safe answer.
      const onCancel = () =>
        dialog.evaluate(
          (el) =>
            el.querySelector('[data-confirm-cancel]')?.contains(document.activeElement) === true,
        );
      await until(onCancel);
      assert.equal(await onCancel(), true, 'focus is not on Cancel');
      // Escape cancels.
      await h.page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached', timeout: 5_000 });
      assert.equal(calls.length, 0);
      // Cancel cancels.
      await discard.click();
      await answerConfirm(h.page, false);
      await h.page.waitForTimeout(300);
      assert.equal(calls.length, 0, 'discarded without a yes');
      // The action discards.
      await discard.click();
      await answerConfirm(h.page, true);
      await until(() => calls.some((c) => c.method === 'DELETE'));
      assert.deepEqual(
        calls.map((c) => c.method),
        ['DELETE'],
      );
    } finally {
      await h.close();
    }
  });

  for (const theme of ['light', 'dark'] as const) {
    void test(`${theme}: above every layer, the action in the danger red, the mark tinted`, async () => {
      const h = await open(`/my-day?day=${TODAY}`, stub([]));
      try {
        await h.page.locator('[data-myday-ready]').waitFor({ timeout: 20_000 });
        await setTheme(h.page, theme);
        await h.page.getByRole('button', { name: 'Discard timer' }).first().click();
        const dialog = h.page.locator('[data-confirm-dialog]');
        await confirmSettled(h.page);
        const box = await dialog.boundingBox();
        assert.ok(box !== null);
        // Nothing lies over its middle.
        const top = await h.page.evaluate(
          ([x, y]) =>
            document.elementFromPoint(x ?? 0, y ?? 0)?.closest('[data-confirm-dialog]') !== null,
          [box.x + box.width / 2, box.y + box.height / 2],
        );
        assert.equal(top, true, 'something covers the dialog');
        const [action, danger] = await h.page.evaluate(() => {
          const probe = document.createElement('div');
          probe.style.color = 'var(--overdue)';
          document.body.append(probe);
          const want = getComputedStyle(probe).color;
          probe.remove();
          const mark = document.querySelector('.confirm-mark');
          return [mark === null ? '' : getComputedStyle(mark).color, want];
        });
        assert.equal(action, danger, 'the mark is not the danger red');
        assert.match(
          (await dialog.locator('[data-confirm-ok] button').getAttribute('class')) ?? '',
          /button-danger/,
        );
      } finally {
        await h.close();
      }
    });
  }

  void test('390 px: Delete entry from the sheet — the two buttons full width, the action above Cancel, the card inside the screen', async () => {
    const h = await open(`/my-day?day=${TODAY}`, stub([]));
    try {
      await h.page.setViewportSize({ width: 390, height: 844 });
      await h.page.locator('[data-myday-ready]').waitFor({ timeout: 20_000 });
      // A phone hides Discard while the timer runs: the sheet's Delete entry asks the same way.
      await h.page.locator('[data-day-tab="confirmed"]').click();
      await h.page.locator('[data-select="e2"]').click();
      await h.page.locator('[data-inspector-for="e2"]').waitFor({ timeout: 5_000 });
      await h.page.locator('[data-entry-delete]').click();
      const dialog = h.page.locator('[data-confirm-dialog]');
      await confirmSettled(h.page);
      const card = await dialog.boundingBox();
      const ok = await dialog.locator('[data-confirm-ok] button').boundingBox();
      const cancel = await dialog.locator('[data-confirm-cancel] button').boundingBox();
      assert.ok(card !== null && ok !== null && cancel !== null);
      assert.ok(card.x >= 0 && card.x + card.width <= 390, 'the card leaves the screen');
      assert.ok(ok.y < cancel.y, 'the action is not above Cancel');
      assert.ok(
        Math.abs(ok.width - cancel.width) <= 1 && ok.width > card.width * 0.8,
        'not full width',
      );
    } finally {
      await h.close();
    }
  });
});
