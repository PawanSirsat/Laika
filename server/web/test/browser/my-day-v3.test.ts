/**
 * My day as the owner's "Laika App v3" design draws it (LAI-888), in a real
 * browser: the Timeline card's header figures, the hours along the top of
 * the track, the lane column's figures, Fit folding the idle hours, the
 * tooltip on a hovered block, ‹ › and ← → stepping along the blocks, and the
 * editor's agents tile — every figure from the stubbed response.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, setTheme, until, type ApiStub, type Harness } from './harness.ts';
import { AGENT, at, TODAY, viewOf, weekData, weekStub } from './my-day-week.ts';

/** The agent at 9:00–9:10 on a card and 9:10–9:15 on none — inside d1 — and at 1 PM. */
const LANE = [
  [at(TODAY, 9, 0), 300, 300],
  [at(TODAY, 9, 5), 240, 240],
  [at(TODAY, 9, 10), 120, 0],
  [at(TODAY, 13, 0), 180, 180],
];

const SIGNAL_TIMES = {
  prompts: [
    [at(TODAY, 9, 10), 2],
    [at(TODAY, 14, 0), 1],
  ],
  commits: [[at(TODAY, 9, 40), 3]],
};

function stub(): ApiStub {
  const data = weekData();
  const routes: Record<string, unknown> = { ...weekStub(data) };
  routes[`/api/v1/me/time?day=${TODAY}`] = () => ({
    ...(viewOf(TODAY, data) as object),
    agent: { ...AGENT, lane: LANE },
    signal_times: SIGNAL_TIMES,
  });
  return routes;
}

async function openToday(): Promise<Harness> {
  const h = await open(`/my-day?day=${TODAY}`, stub());
  await h.page.locator('[data-myday-ready]').waitFor({ timeout: 20_000 });
  await h.page.locator('[data-agents-lane]').waitFor({ timeout: 10_000 });
  return h;
}

const dur = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0
    ? `${String(m)} min`
    : m === 0
      ? `${String(h)} h`
      : `${String(h)} h ${String(m)} min`;
};

const pressed = async (h: Harness, id: string): Promise<boolean> =>
  (await h.page.locator(`[data-block-select="${id}"]`).getAttribute('aria-pressed')) === 'true';

after(async () => {
  await closeBrowser();
});

void describe('the Timeline card (LAI-888, the v3 design)', () => {
  void test('its header carries the day in minutes, the hours run along the top, and the column names each lane with its figure', async () => {
    const h = await openToday();
    try {
      // Confirmed 30 + 30; drafted on a card 95 + 110 + 25; on nothing 40 + 40; gaps 25 + 30 + 40.
      const figure = async (stat: string): Promise<string> =>
        (await h.page.locator(`[data-stat="${stat}"] strong`).innerText()).trim();
      assert.equal(await figure('confirmed'), dur(60));
      assert.equal(await figure('drafted'), dur(230));
      assert.equal(await figure('needs-card'), dur(80));
      assert.equal(await figure('gaps'), dur(95));
      assert.match(await h.page.locator('[data-stat="gaps"]').innerText(), /3 unaccounted/);

      const axis = await h.page.locator('.dayline-axis').boundingBox();
      const row = await h.page.locator('.dayline-row').boundingBox();
      const signals = await h.page.locator('[data-signals-lane]').boundingBox();
      assert.ok(axis !== null && row !== null && signals !== null);
      assert.ok(axis.y + axis.height <= signals.y + 0.5, 'the hours are not above the lanes');
      assert.ok(
        signals.y + signals.height <= row.y + 0.5,
        'the signals lane is not above the blocks',
      );
      const hours = await h.page.locator('.dayline-axis-hour').allInnerTexts();
      assert.ok(hours.includes('9 AM') && hours.includes('1 PM'), `hours: ${hours.join(', ')}`);

      assert.equal((await h.page.locator('[data-you-work]').innerText()).trim(), dur(370));
      assert.equal((await h.page.locator('[data-prompt-total]').innerText()).trim(), '3');
      assert.equal((await h.page.locator('[data-commit-total]').innerText()).trim(), '3');
      assert.equal((await h.page.locator('[data-agent-work]').innerText()).trim(), '14 min');
      assert.equal(
        (await h.page.locator('[data-agent-on-card]').innerText()).trim(),
        '12 min on a card · never your hours',
      );
      // The footer lists the keys, and says nothing is being edited yet.
      const keys = await h.page.locator('.dayline-keys kbd').allInnerTexts();
      assert.deepEqual(keys, ['← →', '↵', 'G', 'X', 'Esc']);
    } finally {
      await h.close();
    }
  });

  void test('Fit folds the idle hours before the first block and after now, and says so', async () => {
    const h = await openToday();
    try {
      // Wide enough that the morning before 8:40 makes room when folded: a
      // fold narrower than its stretch would be stays open (`buildScale`).
      await h.page.setViewportSize({ width: 1600, height: 900 });
      await h.page.locator('[data-zoom="fit"]').click();
      await until(async () => (await h.page.locator('[data-fold]').count()) >= 1);
      const track = h.page.locator('[data-dayline-track]');
      const from = Number(await track.getAttribute('data-from-hour'));
      // The morning before 8:40 is folded, and it starts where the axis does.
      const first = h.page.locator('[data-fold]').first();
      assert.equal(await first.getAttribute('data-fold'), String(from * 60));
      const label = h.page.locator('.dayline-fold-label').first();
      assert.match(
        (await label.getAttribute('aria-label')) ?? '',
        /^No activity, .+8:40 AM, folded$/,
      );
      assert.equal(
        (await h.page.locator('[data-axis-note]').innerText()).trim(),
        'Idle hours folded',
      );
      // Folded, the whole day fits: the track is no wider than its scroller.
      const over = await h.page
        .locator('[data-dayline-scroller]')
        .evaluate((el) => el.scrollWidth - el.clientWidth);
      assert.ok(over <= 1, `the track overflows Fit by ${String(over)}px`);
      // Every block is still placed and the first is still clickable.
      assert.equal(await h.page.locator('[data-block-id]').count(), 6);
      await h.page.locator('[data-block-select="d1"]').click();
      assert.equal(await pressed(h, 'd1'), true);
      // 1× is linear again: nothing folded, and 160 px an hour.
      await h.page.locator('[data-zoom="1"]').click();
      await until(async () => (await h.page.locator('[data-fold]').count()) === 0);
      const to = Number(await track.getAttribute('data-to-hour'));
      const width = await track.evaluate((el) => el.getBoundingClientRect().width);
      assert.equal(Math.round(width), (to - from) * 160);
    } finally {
      await h.close();
    }
  });

  void test('hovering a block, a gap or an agent run says what it is, when and how long — counts only', async () => {
    const h = await openToday();
    try {
      await h.page.locator('[data-block-id="d1"]').hover();
      const tip = h.page.locator('[role="tooltip"]');
      await tip.waitFor({ timeout: 5_000 });
      const said = await tip.innerText();
      assert.match(said, /Drafted/);
      assert.match(said, /LAI-11/);
      assert.match(said, /8:40–10:15 AM/);
      assert.match(said, /1 h 35 min/);
      assert.match(said, /18 prompts · 3 commits · 0 marks/);
      assert.match(said, /worked 11 min, 9 min of it on a card/);
      assert.equal(await tip.getAttribute('data-dayline-tip'), 'block');

      await h.page.locator('.dayline-gap').first().hover();
      await until(async () => (await tip.getAttribute('data-dayline-tip')) === 'gap');
      assert.match(await tip.innerText(), /Gap[\s\S]*No activity · click to fill/);

      await h.page.locator('[data-agent-run]').first().hover();
      await until(async () => (await tip.getAttribute('data-dayline-tip')) === 'agent');
      assert.match(await tip.innerText(), /Agent working[\s\S]*Not counted/);

      // Off the card, it goes.
      await h.page.locator('.myday-plate').hover();
      await until(async () => (await tip.count()) === 0);
    } finally {
      await h.close();
    }
  });

  void test('‹ › and ← → step the selection along every placed block, and the footer says what is being edited', async () => {
    const h = await openToday();
    try {
      // The day's placed blocks, in order: d1 8:40, d2 10:40, e1 11:30, e2 12:00, d3 1:00, d4 3:30.
      await h.page.locator('[data-block-select="d1"]').click();
      assert.equal(await pressed(h, 'd1'), true);
      assert.match(await h.page.locator('[data-foot-hint]').innerText(), /^Editing LAI-11 below/);
      await h.page.getByRole('button', { name: 'Next block' }).click();
      await until(() => pressed(h, 'd2'));
      assert.match(
        await h.page.locator('[data-foot-hint]').innerText(),
        /^Editing Needs a card below/,
      );
      await h.page.keyboard.press('ArrowRight');
      await until(() => pressed(h, 'e1'));
      assert.equal(await h.page.locator('[data-inspector="entry"]').count(), 1);
      await h.page.keyboard.press('ArrowLeft');
      await until(() => pressed(h, 'd2'));
      await h.page.getByRole('button', { name: 'Previous block' }).click();
      await until(() => pressed(h, 'd1'));
      // The arrows never fire while typing.
      await h.page.locator('[data-inspector-for="d1"]').getByLabel('Length, typed').fill('');
      await h.page.keyboard.press('ArrowRight');
      assert.equal(await pressed(h, 'd1'), true);
    } finally {
      await h.close();
    }
  });

  void test('the editor counts the agent runs inside the block and says how long they worked', async () => {
    const h = await openToday();
    try {
      await h.page.locator('[data-block-select="d1"]').click();
      const editor = h.page.locator('[data-inspector-for="d1"]');
      await editor.waitFor({ timeout: 5_000 });
      const tiles = await editor.locator('.inspector-count dt').allInnerTexts();
      assert.deepEqual(tiles, ['prompts', 'commits', 'marks', 'agents']);
      assert.equal((await editor.locator('[data-count="agents"]').innerText()).trim(), '2');
      assert.match(
        await editor.locator('[data-agent-line]').innerText(),
        /^During this time an agent worked 11 min, 9 min of it on a card\./,
      );
      assert.match(await editor.locator('.inspector-kind').innerText(), /Drafted/);
      // A block no agent ran in says so.
      await h.page.locator('[data-block-select="d4"]').click();
      await until(async () => (await h.page.locator('[data-inspector-for="d4"]').count()) === 1);
      const d4 = h.page.locator('[data-inspector-for="d4"]');
      assert.equal((await d4.locator('[data-count="agents"]').innerText()).trim(), '0');
      assert.match(
        await d4.locator('[data-agent-line]').innerText(),
        /^No agent ran in this time\./,
      );
      assert.match(await d4.locator('.inspector-kind').innerText(), /Needs a card/);
    } finally {
      await h.close();
    }
  });

  void test('on a phone, in both themes, the lane column folds away and the figures stay in the header', async () => {
    const h = await openToday();
    try {
      await h.page.setViewportSize({ width: 390, height: 844 });
      for (const theme of ['light', 'dark']) {
        await setTheme(h.page, theme);
        assert.equal(await h.page.locator('.dayline-labels').isVisible(), false);
        assert.equal(
          (await h.page.locator('[data-stat="confirmed"] strong').innerText()).trim(),
          dur(60),
        );
        const sideways = await h.page.evaluate(() => {
          const main = document.querySelector('.shell-main') ?? document.scrollingElement;
          return main === null ? 0 : main.scrollWidth - main.clientWidth;
        });
        assert.ok(sideways <= 1, `${theme}: the page scrolls sideways by ${String(sideways)}px`);
      }
    } finally {
      await h.close();
    }
  });
});
